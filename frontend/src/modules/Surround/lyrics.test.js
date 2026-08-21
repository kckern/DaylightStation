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

  /**
   * AN INSTRUMENTAL NUMBER HANDS THE SCREEN BACK. The Sinfonia and the Pifa
   * have no words, and a lyric rail with no lyric is a mat with nothing in it —
   * worse than an absence, because it is an absence the viewer has to look at.
   * The programme rail comes back and says what is sounding instead.
   *
   * TO GO RED: return `active: true` with empty text for a sounding segment
   * that authored none, as every version before 574abfd69 did.
   */
  it('hands the screen back on an instrumental number', () => {
    const s = at(125);
    expect(s.active).toBe(false);
    expect(s.text).toBe('');
  });

  /**
   * ...BUT A SHORT GAP STILL HOLDS, and the two rules are about different
   * lengths of silence rather than in tension. The rails TRAVEL; sliding them
   * out and back for the seconds between two numbers is the flap the grace
   * window exists to prevent. Ninety seconds of Pifa is not that case.
   *
   * The position is the one place on this rail where NOTHING is sounding and
   * the silence is still short: ten seconds past the last number's end. It is
   * deliberately the same anchor as the revert test below, so the pair reads as
   * one boundary seen from both sides.
   *
   * TO GO RED: delete the grace branch, as the merge did.
   */
  it('holds through a gap shorter than the grace window', () => {
    expect(at(160 + (LYRIC_GRACE_S - 10)).active).toBe(true);
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

  /**
   * THE HEADER IS THE SOURCE AND THE SUBHEADER IS THE MANNER — `heading:` and
   * `subheading:`, the corpus fields of those names. NEITHER IS THE LABEL, and
   * that is the point: `label:` is the incipit, so segment 30 of Messiah has
   * `label: Behold, and see if there be any sorrow` over a `text:` whose first
   * line is that same sentence. Printing it here set one line twice, an inch
   * apart. The numeral goes with it — it is on the time rail under the video.
   *
   * TO GO RED: put the label or the numeral back into either slot.
   */
  it('bills a number by its source and its manner, never by its label', () => {
    const billed = [seg({
      n: 30,
      label: 'Behold, and see if there be any sorrow',
      text: 'Behold, and see if there be any sorrow\nlike unto His sorrow.',
      heading: 'Lamentations 1:12',
      subheading: 'Air (Tenor)',
    })];
    const s = lyricStateAt({ segments: billed, contentId: 'w1', position: 5 });
    expect(s.heading).toBe('Lamentations 1:12');
    expect(s.subheading).toBe('Air (Tenor)');
    expect(s.heading).not.toContain('30');
    expect(s.heading).not.toContain('Behold');
  });

  /**
   * A number authoring only one of the pair PROMOTES it, rather than leaving a
   * subheader captioning an absence.
   *
   * THE NUMBER HAS TO HAVE WORDS FOR THE RULE TO BE REACHED AT ALL. The
   * Sinfonia used to be the fixture here, and once an instrumental went dormant
   * it stopped exercising anything: `billingFor` is never called on a segment
   * whose text is empty. The shipped case is now a texted number that names its
   * manner and not its source — the Hallelujah chorus authors `subheading:` and
   * no `heading:`, and the word belongs over the verse, not under it.
   */
  it('promotes a lone subheading into the header', () => {
    const lone = [seg({ label: 'Hallelujah', subheading: 'Chorus', text: 'Hallelujah!' }),
      seg({ start: 200, end: 260, text: 'and there were shepherds' })];
    const s = lyricStateAt({ segments: lone, contentId: 'w1', position: 5 });
    expect(s.heading).toBe('Chorus');
    expect(s.subheading).toBe('');
  });

  it('reports the sounding index so a caller can key a transition on it', () => {
    // Both positions are inside a TEXTED number, because those are the only
    // ones that report an index now — the Pifa returns the dormant -1.
    expect(at(20).index).toBe(0);
    expect(at(140).index).toBe(2);
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
