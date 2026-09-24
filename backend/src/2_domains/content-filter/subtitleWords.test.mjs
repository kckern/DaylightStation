import { describe, expect, it } from 'vitest';
import {
  SEVERITY_LEVELS, compileWordList, findWordHits, hitToMuteCue, lineContext, parseSrt,
} from './subtitleWords.mjs';

const SRT = `1
00:00:01,000 --> 00:00:03,500
<i>What the HELL</i>
is going on?

2
00:00:04,000 --> 00:00:05,000
Doc!
`;

describe('parseSrt', () => {
  it('parses blocks into lowercased, tag-stripped, single-line text with second timings', () => {
    expect(parseSrt(SRT)).toEqual([
      { start: 1, end: 3.5, text: 'what the hell is going on?' },
      { start: 4, end: 5, text: 'doc!' },
    ]);
  });
  it('accepts CRLF and a dot millisecond separator, skips blocks without a timing line', () => {
    const text = 'junk\r\n\r\n1\r\n00:01:02.250 --> 00:01:03.000\r\nHi\r\n';
    expect(parseSrt(text)).toEqual([{ start: 62.25, end: 63, text: 'hi' }]);
  });
});

describe('compileWordList', () => {
  const doc = {
    meta: { source: 'test' },
    words: {
      hell: { group: 'profanity', tier: 'strict', forms: ['hell', 'hells'] },
      fuck: { group: 'profanity', tier: 'tolerant', forms: ['fuck', 'fucking'] },
      god: { group: 'blasphemy', tier: 'moderate' },
      spook: { group: 'racial', tier: 'tolerant', forms: ['spook'] },
      orphan: { tier: 'strict', forms: ['orphan'] },
    },
    phrases: [{ match: 'oh my god', group: 'blasphemy' }],
  };

  it('maps every form to its leaf and the tier to a severity', () => {
    const list = compileWordList(doc);
    expect(list.byForm.get('hells')).toBe('hell');
    expect(list.byForm.get('fucking')).toBe('fuck');
    expect(list.leaves.hell).toEqual({ group: 'profanity', tier: 'strict', severity: 'low' });
    expect(list.leaves.fuck.severity).toBe('high');
    expect(list.leaves.god.severity).toBe('medium');
  });
  it('uses the leaf itself when forms are missing and skips leaves without a group', () => {
    const list = compileWordList(doc);
    expect(list.byForm.get('god')).toBe('god');
    expect(list.byForm.has('orphan')).toBe(false);
  });
  it('lists distinct groups in file order', () => {
    expect(compileWordList(doc).groups).toEqual(['profanity', 'blasphemy', 'racial']);
  });
  it('rejects a document with no words map', () => {
    expect(() => compileWordList({})).toThrow(/words/);
  });
  it('exposes the severity scale lowest first', () => {
    expect(SEVERITY_LEVELS).toEqual(['low', 'medium', 'high']);
  });
});


describe('findWordHits', () => {
  const list = compileWordList({ words: {
    hell: { group: 'profanity', tier: 'strict', forms: ['hell'] },
    damn: { group: 'profanity', tier: 'strict', forms: ['damn'] },
    god: { group: 'blasphemy', tier: 'moderate', forms: ['god', 'gods'] },
  } });

  it('matches whole normalised tokens only (no Scunthorpe)', () => {
    const lines = [{ start: 10, end: 12, text: 'hello shell hell-o' }];
    expect(findWordHits(lines, list)).toEqual([]);
  });
  it('places word i at start + i*0.33, capped at the line end, id = line start ms + token index', () => {
    const lines = [{ start: 10, end: 10.5, text: 'oh my god, what the hell' }];
    // god is token 2 -> 10.66, hell is token 5 -> 11.65; both capped to 10.5.
    // Both words get their own cue: disabling one (a prayer's "god") must never
    // leave the other ("hell") without a mute.
    expect(findWordHits(lines, list)).toEqual([
      { cueId: 'srt10000_2', lineIndex: 0, token: 'god', leaf: 'god', group: 'blasphemy',
        category: 'language/blasphemy/god', severity: 'medium', in: 10.5, out: 10.55 },
      { cueId: 'srt10000_5', lineIndex: 0, token: 'hell', leaf: 'hell', group: 'profanity',
        category: 'language/profanity/hell', severity: 'low', in: 10.5, out: 10.55 },
    ]);
  });
  it('keeps ids stable when the word list changes (ids depend on the SRT only)', () => {
    const lines = [{ start: 10, end: 12, text: 'oh my god, what the hell' }];
    const narrower = compileWordList({ words: { hell: { group: 'profanity', tier: 'strict', forms: ['hell'] } } });
    expect(findWordHits(lines, narrower).map((h) => h.cueId)).toEqual(['srt10000_5']);
    expect(findWordHits(lines, list).map((h) => h.cueId)).toEqual(['srt10000_2', 'srt10000_5']);
  });
  it('drops only true duplicates (a repeated subtitle block at the same start)', () => {
    const line = { start: 10, end: 12, text: 'what the hell' };
    expect(findWordHits([line, { ...line }], list).map((h) => [h.cueId, h.lineIndex])).toEqual([['srt10000_2', 0]]);
  });
  it('emits one hit per listed word, across lines', () => {
    const lines = [
      { start: 100, end: 104, text: 'god damn it' },
      { start: 200, end: 202, text: "gods, that's hell" },
    ];
    expect(findWordHits(lines, list).map((h) => [h.cueId, h.lineIndex, h.token, h.in])).toEqual([
      ['srt100000_0', 0, 'god', 100],
      ['srt100000_1', 0, 'damn', 100.33],
      ['srt200000_0', 1, 'gods', 200],
      ['srt200000_2', 1, 'hell', 200.66],
    ]);
  });
  it('does not collapse a word to t=0 when the end timestamp is unparseable', () => {
    const hits = findWordHits([{ start: 50, end: null, text: 'x hell' }], list);
    expect(hits[0].in).toBe(50.33);
  });
});

describe('hitToMuteCue', () => {
  it('builds the override addCue srt-mutes stores, now with severity and channel', () => {
    const hit = { cueId: 'srt100000_1', lineIndex: 0, token: 'damn', leaf: 'damn', group: 'profanity',
      category: 'language/profanity/damn', severity: 'low', in: 100.33, out: 100.38 };
    expect(hitToMuteCue(hit)).toEqual({
      id: 'srt100000_1', effect: 'mute', category: 'language/profanity/damn', channel: 'audio',
      severity: 'low', in: 100.33, out: 100.38, label: 'damn', source: 'srt', precision: 'srt-line',
    });
  });
});

describe('lineContext', () => {
  const lines = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
  it('returns the line and its neighbours', () => {
    expect(lineContext(lines, 1)).toEqual({ line: 'b', before: 'a', after: 'c' });
  });
  it('uses empty strings at the edges', () => {
    expect(lineContext(lines, 0)).toEqual({ line: 'a', before: '', after: 'b' });
    expect(lineContext(lines, 2)).toEqual({ line: 'c', before: 'b', after: '' });
  });
});
