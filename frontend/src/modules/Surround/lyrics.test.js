import { describe, it, expect } from 'vitest';
import { LYRIC_GRACE_S, lyricStateAt, paginate, railHasText } from './lyrics.js';

/**
 * A rail shaped like the store's: flattened, every segment carrying the
 * contentId of the media item it belongs to, with `start`/`end` in that item's
 * own seconds and `offset`/`duration` on the container's clock.
 */
const seg = (over) => ({
  contentId: 'w1', start: 0, end: 10, offset: 0, duration: 10, name: 'x', ...over,
});

describe('railHasText', () => {
  it('is false when no segment carries sung text', () => {
    expect(railHasText([seg({}), seg({ start: 10, end: 20 })])).toBe(false);
  });

  it('is true when any segment on the rail carries text', () => {
    expect(railHasText([seg({}), seg({ start: 10, end: 20, text: 'Comfort ye' })])).toBe(true);
  });

  it('ignores whitespace-only text', () => {
    expect(railHasText([seg({ text: '   \n  ' })])).toBe(false);
  });

  it('survives a missing rail', () => {
    expect(railHasText(null)).toBe(false);
  });
});

describe('lyricStateAt', () => {
  const rail = [
    seg({ start: 10, end: 40, offset: 0, duration: 30, text: 'Comfort ye', name: 'Comfort ye' }),
    // The Pifa: a sounding number with no words between two texted ones.
    seg({ start: 40, end: 130, offset: 30, duration: 90, name: 'Pifa' }),
    seg({ start: 130, end: 160, offset: 120, duration: 30, text: 'There were shepherds' }),
  ];
  const at = (position, over) => lyricStateAt({ segments: rail, contentId: 'w1', position, ...over });

  it('is dormant before the first segment sounds', () => {
    expect(at(2).active).toBe(false);
  });

  it('comes up on the first segment carrying text', () => {
    const s = at(20);
    expect(s.active).toBe(true);
    expect(s.text).toBe('Comfort ye');
    expect(s.heading).toBe('Comfort ye');
  });

  it('stays up through an instrumental number, showing no text', () => {
    // 85 s into the Pifa — far beyond the grace window, but a segment IS
    // sounding, so this is not a gap and the rail must not flap.
    const s = at(125);
    expect(s.active).toBe(true);
    expect(s.text).toBe('');
    expect(s.heading).toBe('Pifa');
  });

  it('holds through a gap shorter than the grace window', () => {
    expect(at(40 + (LYRIC_GRACE_S - 10)).active).toBe(true);
  });

  it('reverts once nothing has sounded for longer than the grace window', () => {
    expect(at(160 + LYRIC_GRACE_S + 1).active).toBe(false);
  });

  it('is dormant on a rail whose segments carry no text at all', () => {
    const dry = [seg({ start: 0, end: 10 })];
    expect(lyricStateAt({ segments: dry, contentId: 'w1', position: 5 }).active).toBe(false);
  });

  it('ignores segments belonging to another item on the same rail', () => {
    const s = lyricStateAt({ segments: rail, contentId: 'other', position: 20 });
    expect(s.active).toBe(false);
  });

  it('prefixes the heading with the segment numeral when the corpus gives one', () => {
    const numbered = [seg({ n: 2, name: 'Ev’ry valley', text: 'Ev’ry valley' })];
    expect(lyricStateAt({ segments: numbered, contentId: 'w1', position: 5 }).heading)
      .toBe('2. Ev’ry valley');
  });

  it('reports the sounding index so a caller can key a transition on it', () => {
    expect(at(20).index).toBe(0);
    expect(at(125).index).toBe(1);
  });
});

describe('paginate', () => {
  it('keeps one page when every line fits', () => {
    expect(paginate([10, 10, 10], 40)).toEqual([[0, 1, 2]]);
  });

  it('breaks where the next line would overflow the box', () => {
    expect(paginate([10, 10, 10, 10], 25)).toEqual([[0, 1], [2, 3]]);
  });

  it('never drops a line taller than the box — it gets a page to itself', () => {
    expect(paginate([50, 10], 20)).toEqual([[0], [1]]);
  });

  it('returns no pages for no lines', () => {
    expect(paginate([], 100)).toEqual([]);
  });

  it('falls back to a single page when the box has not been measured', () => {
    expect(paginate([10, 10], 0)).toEqual([[0, 1]]);
  });
});
