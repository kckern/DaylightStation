import { describe, expect, it } from 'vitest';
import { SEVERITY_LEVELS, compileWordList, parseSrt } from './subtitleWords.mjs';

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
