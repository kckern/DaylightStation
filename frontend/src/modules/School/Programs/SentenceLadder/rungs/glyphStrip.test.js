import { describe, it, expect } from 'vitest';
import { columnsFor } from './glyphStrip.js';

// `committed` is the settled prefix from FieldComposer.compositionState — never
// the raw field value. In 두벌식 a consonant is ambiguous until the next vowel
// lands: typing 오늘, the field reads 온 after ㄴ and only the following vowel
// decides whether that ㄴ closed 오 or opened 늘. Feeding the strip the field's
// value is what made the prompt collapse on the first keystroke of a syllable.
const cols = (target, committed, pending, opts) =>
  columnsFor({ target, committed, pending, ...opts }).map((c) => `${c.want}:${c.state}`);

describe('columnsFor', () => {
  it('marks settled columns right or wrong, and the next one current', () => {
    expect(cols('오늘', '오', '느')).toEqual(['오:done', '늘:current']);
    expect(cols('오늘', '우', '')).toEqual(['오:wrong', '늘:current']);
  });

  // THE PORTAL BUG. Mid-syllable the field reads 온; the strip must not flinch.
  it('does not regress while a syllable is ambiguous', () => {
    expect(cols('오늘', '', '오')).toEqual(['오:current', '늘:next']);
    expect(cols('오늘', '', '온')).toEqual(['오:current', '늘:next']);
  });

  it('shows exactly one glyph beyond the current one, ghosted', () => {
    expect(cols('가나다라', '', '')).toEqual(['가:current', '나:next', '다:hidden', '라:hidden']);
  });

  // Listen mode starts blind; a peek turns every column visible at once.
  it('hides the model entirely when asked, and shows all of it on a peek', () => {
    expect(cols('오늘', '', '', { reveal: 'none' })).toEqual(['오:blind', '늘:blind']);
    expect(cols('오늘', '', '', { reveal: 'all' })).toEqual(['오:current', '늘:next']);
  });

  it('carries what the learner actually put in each column', () => {
    const out = columnsFor({ target: '오늘', committed: '우', pending: '느' });
    expect(out[0]).toEqual({ want: '오', got: '우', state: 'wrong' });
    expect(out[1]).toEqual({ want: '늘', got: '느', state: 'current' });
  });

  // A caller mid-load has no sentence yet. An empty strip, never a throw:
  // the rung renders before the day's audio and text have arrived.
  it('treats a missing target as an empty strip rather than throwing', () => {
    expect(columnsFor({ target: null, committed: '오' })).toEqual([]);
    expect(columnsFor({ target: undefined, committed: undefined })).toEqual([]);
    expect(columnsFor({})).toEqual([]);
    expect(columnsFor()).toEqual([]);
  });

  // A missing/garbled `committed` must not silently light up column 0 as done.
  it('treats a missing committed prefix as nothing typed yet', () => {
    expect(cols('오늘', null, null)).toEqual(['오:current', '늘:next']);
  });

  // Array.from, not split(''): precomposed Hangul is one code point, but the
  // surrounding code must not assume BMP-only — an astral glyph is ONE column.
  it('counts astral code points as one column each', () => {
    expect(columnsFor({ target: '𝄞가', committed: '' }).map((c) => c.want)).toEqual(['𝄞', '가']);
  });

  // Overtyping past the end: every column is settled, nothing is current.
  it('settles every column once the learner has typed past the end', () => {
    expect(cols('오늘', '오늘늘', '')).toEqual(['오:done', '늘:done']);
  });
});
