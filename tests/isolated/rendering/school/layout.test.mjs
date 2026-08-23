import { describe, it, expect } from 'vitest';
import { placeFragments, contentHeightPt } from '../../../../backend/src/1_rendering/school/documents/layout.mjs';

// Distinct gaps per class pair so a wrong lookup cannot coincidentally pass.
const spacing = {
  heading: { heading: 2, body: 8, question: 10 },
  body: { heading: 16, body: 6, question: 12 },
  question: { heading: 18, body: 4, question: 14 },
};

// Usable content height: 200 - 2*20 = 160pt.
const page = { pageHeightPt: 200, marginPt: 20, spacing };
const CONTENT_BOTTOM_PT = 180;

const frag = (id, heightPt, extra = {}) => ({
  id,
  blocks: [{ type: 'text', id: `${id}-b` }],
  heightPt,
  atomic: false,
  spacingClass: 'body',
  ...extra,
});

const lines = (count, heightPt) => Array.from({ length: count }, () => ({ heightPt }));

const idsOf = (result) => result.pages.map((p) => p.fragments.map((f) => f.id));
const find = (result, pageIndex, id) => result.pages[pageIndex].fragments.find((f) => f.id === id);

describe('placeFragments — basics', () => {
  it('returns no pages for an empty fragment list', () => {
    expect(placeFragments([], page)).toEqual({ pages: [], errors: [] });
  });

  it('places the first fragment at the top margin and preserves its blocks', () => {
    const input = [frag('a', 30)];
    const result = placeFragments(input, page);
    expect(result.errors).toEqual([]);
    expect(result.pages).toHaveLength(1);
    expect(find(result, 0, 'a').yPt).toBe(20);
    expect(find(result, 0, 'a').blocks).toEqual(input[0].blocks);
  });

  it('does not mutate the input fragments', () => {
    const input = [frag('a', 30), frag('b', 40)];
    const snapshot = structuredClone(input);
    placeFragments(input, page);
    expect(input).toEqual(snapshot);
  });

  it('keeps a fragment that exactly fills the remaining space on the same page', () => {
    // 100 + 6pt gap + 54 == 160pt usable.
    const result = placeFragments([frag('a', 100), frag('b', 54)], page);
    expect(result.errors).toEqual([]);
    expect(idsOf(result)).toEqual([['a', 'b']]);
    expect(find(result, 0, 'b').yPt).toBe(126);
    expect(find(result, 0, 'b').yPt + 54).toBe(CONTENT_BOTTOM_PT);
  });

  it('starts a new page when the next fragment overflows by any amount', () => {
    const result = placeFragments([frag('a', 100), frag('b', 55)], page);
    expect(idsOf(result)).toEqual([['a'], ['b']]);
    expect(find(result, 1, 'b').yPt).toBe(20);
  });
});

describe('placeFragments — spacing classes', () => {
  it('uses spacing[prevClass][nextClass] for the inter-fragment gap', () => {
    const headingThenBody = placeFragments(
      [frag('x', 30, { spacingClass: 'heading' }), frag('y', 30, { spacingClass: 'body' })],
      page,
    );
    const bodyThenQuestion = placeFragments(
      [frag('x', 30, { spacingClass: 'body' }), frag('y', 30, { spacingClass: 'question' })],
      page,
    );
    expect(find(headingThenBody, 0, 'y').yPt - find(headingThenBody, 0, 'x').yPt).toBe(38);
    expect(find(bodyThenQuestion, 0, 'y').yPt - find(bodyThenQuestion, 0, 'x').yPt).toBe(42);
  });

  it('applies no gap before the first fragment of a page', () => {
    const result = placeFragments(
      [frag('a', 150, { spacingClass: 'question' }), frag('b', 30, { spacingClass: 'question' })],
      page,
    );
    expect(idsOf(result)).toEqual([['a'], ['b']]);
    expect(find(result, 1, 'b').yPt).toBe(20);
  });

  it('treats an unconfigured class pair as zero spacing', () => {
    const result = placeFragments([frag('a', 30), frag('b', 30)], { ...page, spacing: {} });
    expect(find(result, 0, 'b').yPt).toBe(50);
  });
});

describe('placeFragments — keep-together', () => {
  it('moves an atomic fragment that does not fit whole to the next page', () => {
    const result = placeFragments(
      [frag('q1', 100), frag('q2', 80, { atomic: true }), frag('q3', 20)],
      page,
    );
    expect(result.errors).toEqual([]);
    expect(idsOf(result)).toEqual([['q1'], ['q2', 'q3']]);
    expect(find(result, 1, 'q2').yPt).toBe(20);
  });

  it('reports an error for an atomic fragment taller than a full page and never places it', () => {
    const result = placeFragments(
      [frag('q1', 40), frag('q3', 400, { atomic: true }), frag('q4', 30)],
      page,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('q3');
    expect(result.errors[0].message).toBe("atomic fragment 'q3' exceeds page height");
    expect(idsOf(result).flat()).toEqual(['q1', 'q4']);
  });

  it('terminates on a lone unsplittable fragment taller than a page', () => {
    const result = placeFragments([frag('solo', 500)], page);
    expect(result.pages).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('solo');
    expect(result.errors[0].message).toMatch(/exceeds page height/);
  });

  it('reports an error when a single line is taller than a page', () => {
    const result = placeFragments([frag('p', 400, { lines: lines(2, 200) })], page);
    expect(result.pages).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('p');
  });
});

// F4 (review finding): short_answer/essay's prompt fragment must never
// strand on one page while its own write-space fragment lands on the next
// (measure.mjs tags the prompt with `stickToNextId: <space fragment id>`).
describe('placeFragments — keep-with-next (stickToNextId)', () => {
  it('moves the prompt WITH its write-space when the space alone would not fit after it', () => {
    // 130pt of room: the 20pt prompt fits easily, but the 40pt space that
    // must immediately follow it would not (130 - 20 - 6(gap) = 104pt is
    // plenty for JUST the space — pick a filler so only ~10pt remains).
    const result = placeFragments(
      [
        frag('filler', 130),
        frag('prompt', 20, { stickToNextId: 'space' }),
        frag('space', 40, { atomic: true }),
      ],
      page,
    );
    expect(idsOf(result)).toEqual([['filler'], ['prompt', 'space']]);
    expect(find(result, 1, 'prompt').yPt).toBe(20);
  });

  it('keeps the prompt on the SAME page as its space when both fit together (no behavior change in the common case)', () => {
    const result = placeFragments(
      [frag('prompt', 20, { stickToNextId: 'space' }), frag('space', 40, { atomic: true })],
      page,
    );
    expect(idsOf(result)).toEqual([['prompt', 'space']]);
  });

  it('does not apply the stick rule on an empty page — a combo too big to share a page still places the prompt normally rather than looping', () => {
    // 'prompt' is the first (page-empty) fragment, so the rule is skipped and
    // it places at the top of page 1; 'space' (150pt) does not fit after it
    // (134pt left) but fits a FRESH empty page (160pt usable) on its own —
    // the same outcome a plain fragment pair with no stick affinity gets.
    const result = placeFragments(
      [frag('prompt', 20, { stickToNextId: 'space' }), frag('space', 150, { atomic: true })],
      page,
    );
    expect(idsOf(result)).toEqual([['prompt'], ['space']]);
  });

  it('is not broken by the balance pass — the rebalance must not strand a prompt its partner was glued to', () => {
    // REGRESSION (phaseB kitchen sink, 2026-08-23): the `fill` policy's
    // rebalance runs BEFORE the keep-with-next check, and would end the page
    // on the write-space purely because stopping there landed nearer the
    // per-page target — leaving the essay prompt alone at the foot of one
    // page and its ruled lines at the top of the next.
    //
    // Geometry: 160pt usable, 228pt of content over 2 pages → a 114pt/page
    // target. After filler(70)+prompt(20) the page holds 96pt; adding the
    // 50pt space reaches 152pt, which overshoots 114 by more (38) than
    // stopping short of it does (18) — so balance wants to break exactly
    // between the two. It must not: the space fits under the hard ceiling
    // (58pt left), which is the only thing that gets to decide here.
    const fragments = [
      frag('filler', 70),
      frag('prompt', 20, { stickToNextId: 'space' }),
      frag('space', 50, { atomic: true }),
      frag('tail', 70),
    ];
    const result = placeFragments(fragments, { ...page, balance: true });
    expect(idsOf(result)).toEqual([['filler', 'prompt', 'space'], ['tail']]);
  });

  it('is a no-op when the very next fragment is not the named partner', () => {
    const result = placeFragments(
      [
        frag('filler', 130),
        frag('prompt', 20, { stickToNextId: 'space' }),
        frag('unrelated', 5),
        frag('space', 40, { atomic: true }),
      ],
      page,
    );
    // 'prompt' still fits (130+6+20=156 of 160); its named partner is NOT
    // next in the queue ('unrelated' is), so it places normally.
    expect(find(result, 0, 'prompt')).toBeTruthy();
  });
});

describe('placeFragments — widow and orphan control', () => {
  const paragraph = (id, lineCount, lineHeight = 10, extra = {}) =>
    frag(id, lineCount * lineHeight, { lines: lines(lineCount, lineHeight), ...extra });

  it('splits a 5-line paragraph 3+2 rather than 4+1', () => {
    // 114pt above + a 6pt gap leaves 40pt — four lines fit, but taking four
    // would strand a single line on the next page.
    const result = placeFragments([frag('a', 114), paragraph('p', 5)], page);
    expect(result.errors).toEqual([]);
    expect(find(result, 0, 'p').lines).toHaveLength(3);
    expect(find(result, 0, 'p').heightPt).toBe(30);
    expect(find(result, 0, 'p').yPt).toBe(140);
    expect(find(result, 0, 'p').continuesOnNextPage).toBe(true);
    expect(find(result, 1, 'p').lines).toHaveLength(2);
    expect(find(result, 1, 'p').isContinuation).toBe(true);
    expect(find(result, 1, 'p').yPt).toBe(20);
  });

  it('moves the whole paragraph when too few lines would remain on the earlier page', () => {
    // 144pt above leaves room for exactly one line — below minLinesBeforeBreak.
    const result = placeFragments([frag('a', 144), paragraph('p', 5)], page);
    expect(idsOf(result)).toEqual([['a'], ['p']]);
    expect(find(result, 1, 'p').lines).toHaveLength(5);
    expect(find(result, 1, 'p').isContinuation).toBe(false);
  });

  it('moves a paragraph that cannot satisfy both constraints at once', () => {
    // 20pt of room fits 2 of the 3 lines, but a 2+1 break orphans the last line
    // and a 1+2 break is below minLinesBeforeBreak.
    const result = placeFragments([frag('a', 134), paragraph('p', 3)], page);
    expect(idsOf(result)).toEqual([['a'], ['p']]);
    expect(find(result, 1, 'p').lines).toHaveLength(3);
  });

  it('honours per-fragment minLinesBeforeBreak and minLinesAfterBreak', () => {
    // 40pt of room fits 4 of the 6 lines, but 3 must be left for the next page.
    const result = placeFragments(
      [frag('a', 114), paragraph('p', 6, 10, { minLinesBeforeBreak: 3, minLinesAfterBreak: 3 })],
      page,
    );
    expect(find(result, 0, 'p').lines).toHaveLength(3);
    expect(find(result, 1, 'p').lines).toHaveLength(3);
  });

  it('marks a paragraph that fits whole as unsplit', () => {
    const result = placeFragments([paragraph('p', 5)], page);
    expect(find(result, 0, 'p').lines).toHaveLength(5);
    expect(find(result, 0, 'p').continuesOnNextPage).toBe(false);
    expect(find(result, 0, 'p').isContinuation).toBe(false);
  });

  it('splits a paragraph longer than one page across three pages', () => {
    const result = placeFragments([paragraph('long', 40)], page);
    expect(result.errors).toEqual([]);
    const placed = result.pages.flatMap((p) => p.fragments);
    expect(placed.reduce((total, f) => total + f.lines.length, 0)).toBe(40);
    expect(result.pages).toHaveLength(3);
  });

  it('derives fragment height from the lines when lines are present', () => {
    const result = placeFragments([frag('p', 999, { lines: lines(4, 10) })], page);
    expect(find(result, 0, 'p').heightPt).toBe(40);
  });
});

describe('placeFragments — answer-space distribution', () => {
  const answer = (id, minPt, maxPt) => frag(id, minPt, { answerSpace: { minPt, maxPt } });

  // Page 1 uses 40 + 6 + 10 + 6 + 10 + 6 + 22 = 100pt of 160 → 60pt spare.
  const craftedPage = [
    frag('q1', 40),
    answer('a1', 10, 40),
    answer('a2', 10, 100),
    frag('filler', 22),
    frag('next', 150),
  ];

  it('distributes leftover space evenly across the answer spaces of a non-final page', () => {
    const result = placeFragments(craftedPage, page);
    expect(idsOf(result)).toEqual([['q1', 'a1', 'a2', 'filler'], ['next']]);
    expect(find(result, 0, 'a1').heightPt).toBe(40);
    expect(find(result, 0, 'a2').heightPt).toBe(40);
  });

  it('redistributes the remainder when one answer space hits its maximum', () => {
    // Spare 60pt over headrooms of 10 and 90 → +10 then +50.
    const result = placeFragments(
      [frag('q1', 40), answer('a1', 10, 20), answer('a2', 10, 100), frag('filler', 22), frag('next', 150)],
      page,
    );
    expect(find(result, 0, 'a1').heightPt).toBe(20);
    expect(find(result, 0, 'a2').heightPt).toBe(60);
  });

  it('pushes later fragments down by the amount the answer spaces grew', () => {
    const result = placeFragments(craftedPage, page);
    expect(find(result, 0, 'a1').yPt).toBe(66);
    expect(find(result, 0, 'a2').yPt).toBe(112);
    expect(find(result, 0, 'filler').yPt).toBe(158);
    expect(find(result, 0, 'filler').yPt + 22).toBe(CONTENT_BOTTOM_PT);
  });

  it('never grows an answer space beyond its maximum even with space to spare', () => {
    const result = placeFragments([frag('q1', 10), answer('a1', 10, 25), frag('next', 150)], page);
    expect(find(result, 0, 'a1').heightPt).toBe(25);
  });

  it('leaves the final page unexpanded', () => {
    const result = placeFragments([frag('q1', 10), answer('a1', 10, 100)], page);
    expect(result.pages).toHaveLength(1);
    expect(find(result, 0, 'a1').heightPt).toBe(10);
  });

  it('never places an answer space below its minimum', () => {
    const result = placeFragments([{ ...answer('a1', 30, 60), heightPt: 0 }], page);
    expect(find(result, 0, 'a1').heightPt).toBe(30);
  });

  it('reports an error when an answer space declares maxPt below minPt', () => {
    const result = placeFragments([frag('bad', 20, { answerSpace: { minPt: 40, maxPt: 10 } })], page);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('bad');
    expect(result.errors[0].message).toMatch(/maxPt/);
  });

  it('leaves a page without answer spaces untouched', () => {
    const result = placeFragments([frag('q1', 20), frag('next', 150)], page);
    expect(idsOf(result)).toEqual([['q1'], ['next']]);
    expect(find(result, 0, 'q1').heightPt).toBe(20);
    expect(find(result, 0, 'q1').yPt).toBe(20);
  });
});

describe('placeFragments — determinism', () => {
  it('produces deep-equal output for identical input across runs', () => {
    const build = () => [
      frag('h', 24, { spacingClass: 'heading' }),
      frag('q1', 90, { atomic: true }),
      frag('p', 50, { lines: lines(5, 10) }),
      frag('a1', 10, { answerSpace: { minPt: 10, maxPt: 80 } }),
      frag('q2', 120, { atomic: true, spacingClass: 'question' }),
    ];
    expect(placeFragments(build(), page)).toEqual(placeFragments(build(), page));
  });
});

// `growLastPage` is the mechanics behind fit policy `fill` (spec §7): the
// engine's deliberate "trailing space on the last page belongs to the
// document" exclusion inverts ONLY when this flag is set. Every fixture below
// is also run WITHOUT the flag (or comes straight from the suite above) to
// prove default behavior stays byte-identical.
describe('placeFragments — growLastPage (policy: fill)', () => {
  const answer = (id, minPt, maxPt) => frag(id, minPt, { answerSpace: { minPt, maxPt } });

  it('defaults to false: the last page stays unexpanded (unchanged from the base suite)', () => {
    const result = placeFragments([frag('q1', 10), answer('a1', 10, 100)], page);
    expect(result.pages).toHaveLength(1);
    expect(find(result, 0, 'a1').heightPt).toBe(10);
  });

  it('grows the last (and only) page into its trailing space when true', () => {
    const result = placeFragments([frag('q1', 10), answer('a1', 10, 100)], { ...page, growLastPage: true });
    expect(result.pages).toHaveLength(1);
    expect(find(result, 0, 'a1').heightPt).toBe(100);
  });

  it('distributes mastery-question remainder as space-around, including above question 1', () => {
    const result = placeFragments([
      frag('header', 20),
      frag('q1', 10, { fillAfter: true }),
      frag('q2', 10, { fillAfter: true }),
      frag('q3', 10, { fillAfter: true }),
    ], { ...page, growLastPage: true });
    const header = find(result, 0, 'header');
    const q1 = find(result, 0, 'q1');
    const q2 = find(result, 0, 'q2');
    const q3 = find(result, 0, 'q3');
    const leadingExtra = q1.yPt - (header.yPt + header.heightPt + spacing.body.body);
    const firstBetweenExtra = q2.yPt - (q1.yPt + 10 + spacing.body.body);
    const secondBetweenExtra = q3.yPt - (q2.yPt + 10 + spacing.body.body);
    const trailingExtra = CONTENT_BOTTOM_PT - (q3.yPt + q3.heightPt);

    expect(firstBetweenExtra).toBeCloseTo(leadingExtra * 2);
    expect(secondBetweenExtra).toBeCloseTo(leadingExtra * 2);
    expect(trailingExtra).toBeCloseTo(leadingExtra);
  });

  it('grows a non-last page identically whether or not the flag is set — only the LAST page inverts', () => {
    // Page 1: q1(40) + a1(10..40) + filler(94) = 150pt of 160pt usable → 10pt
    // spare, all of it going to a1's headroom (30pt) capped at +10.
    // 'a2' (10..50) then overflows page 1 by 2pt and starts page 2 alone,
    // where it sits as the sole (and last) fragment with 150pt of spare.
    const fragments = [
      frag('q1', 40),
      answer('a1', 10, 40),
      frag('filler', 94),
      answer('a2', 10, 50),
    ];

    const withoutFlag = placeFragments(fragments, page);
    expect(idsOf(withoutFlag)).toEqual([['q1', 'a1', 'filler'], ['a2']]);
    expect(find(withoutFlag, 0, 'a1').heightPt).toBe(14);
    expect(find(withoutFlag, 1, 'a2').heightPt).toBe(10); // last page: unexpanded, as always.

    const withFlag = placeFragments(fragments, { ...page, growLastPage: true });
    expect(idsOf(withFlag)).toEqual([['q1', 'a1', 'filler'], ['a2']]);
    expect(find(withFlag, 0, 'a1').heightPt).toBe(14); // non-last page: identical either way.
    expect(find(withFlag, 1, 'a2').heightPt).toBe(50); // last page: now grown to its cap.
  });
});

// A `page_break` block (spec §6) measures to a zero-height `forceBreak`
// fragment (measure.mjs `fragmentFromNode`); placement is what turns that
// marker into an actual page boundary.
describe('placeFragments — forceBreak (page_break)', () => {
  const pageBreak = (id = 'pb') => ({
    id, blocks: [], heightPt: 0, atomic: true, spacingClass: null, forceBreak: true,
  });

  it('ends the current page unconditionally, even with room to spare', () => {
    const result = placeFragments([frag('a', 30), pageBreak(), frag('b', 30)], page);
    expect(idsOf(result)).toEqual([['a'], ['b']]);
    expect(find(result, 1, 'b').yPt).toBe(20);
  });

  it('is consumed by placement — never appears in any page’s fragments', () => {
    const result = placeFragments([frag('a', 30), pageBreak('pb1'), frag('b', 30)], page);
    expect(result.pages.flatMap((p) => p.fragments.map((f) => f.id))).toEqual(['a', 'b']);
  });

  it('is a no-op at the very start of the document — no blank leading page', () => {
    const result = placeFragments([pageBreak(), frag('a', 30)], page);
    expect(result.pages).toHaveLength(1);
    expect(find(result, 0, 'a').yPt).toBe(20);
  });

  it('collapses consecutive breaks into a single page boundary — no blank pages between them', () => {
    const result = placeFragments(
      [frag('a', 30), pageBreak('pb1'), pageBreak('pb2'), frag('b', 30)],
      page,
    );
    expect(idsOf(result)).toEqual([['a'], ['b']]);
  });

  it('is a no-op at the very end of the document — no trailing blank page', () => {
    const result = placeFragments([frag('a', 30), pageBreak()], page);
    expect(result.pages).toHaveLength(1);
  });

  it('never lets its own null spacingClass zero the gap it sits in — it is dropped, not placed', () => {
    // Carry from Task 5's review: a placed page_break fragment with
    // spacingClass:null would zero gapBetween(prev, null) for whatever came
    // right after it. That risk is moot here because the break consumes the
    // fragment outright — the next fragment starts a fresh page, where the
    // first-of-page gap is unconditionally 0 for ANY spacingClass (same rule
    // every other page start already follows).
    const result = placeFragments(
      [frag('a', 30, { spacingClass: 'heading' }), pageBreak(), frag('b', 30, { spacingClass: 'question' })],
      page,
    );
    expect(find(result, 1, 'b').yPt).toBe(20);
  });
});

// `contentHeightPt` answers "how tall would this document be as ONE
// unbroken page" — the figure `RenderPrintDocument` (Task 8) needs to compute
// fit policy `one-page`'s `oversetPt` (spec §7): how far a document that DID
// paginate would have overrun a single page's budget.
describe('contentHeightPt', () => {
  it('is 0 for an empty fragment list', () => {
    expect(contentHeightPt([], { spacing })).toBe(0);
  });

  it('sums heights plus the gaps between consecutive spacing classes, matching placeFragments’ own walk', () => {
    const fragments = [frag('a', 100, { spacingClass: 'body' }), frag('b', 54, { spacingClass: 'body' })];
    // 100 + gap(body,body)=6 + 54 == 160, the same total the "exactly fills"
    // placeFragments test above derives from spacing/page geometry.
    expect(contentHeightPt(fragments, { spacing })).toBe(160);
  });

  it('is insensitive to where placeFragments would have broken pages — same total whether or not it fits one real page', () => {
    const fragments = [frag('a', 100, { spacingClass: 'body' }), frag('b', 55, { spacingClass: 'body' })];
    // This exact input starts a NEW page in placeFragments (161pt > 160pt
    // usable) — contentHeightPt reports the flat total regardless.
    expect(contentHeightPt(fragments, { spacing })).toBe(161);
  });

  it('ignores forceBreak fragments and resets the gap after one, exactly like a real page start', () => {
    const withBreak = [
      frag('a', 30, { spacingClass: 'heading' }),
      { id: 'pb', blocks: [], heightPt: 0, atomic: true, spacingClass: null, forceBreak: true },
      frag('b', 30, { spacingClass: 'question' }),
    ];
    const withoutBreak = [
      frag('a', 30, { spacingClass: 'heading' }),
      { ...frag('b', 30, { spacingClass: 'question' }), spacingClass: null },
    ];
    // No heading→question gap crosses the break (previousClass resets to
    // null, same as the first fragment on a fresh page) — total is just the
    // two fragment heights, matching a next-fragment gap of 0 either way.
    expect(contentHeightPt(withBreak, { spacing })).toBe(60);
    expect(contentHeightPt(withoutBreak, { spacing })).toBe(60);
  });

  it('uses answerSpace.minPt (not a stale heightPt) for an unmeasured answer space, same normalization placeFragments applies', () => {
    const fragments = [{
      id: 'a1', blocks: [], heightPt: 5, atomic: true, spacingClass: 'body', answerSpace: { minPt: 40, maxPt: 100 },
    }];
    expect(contentHeightPt(fragments, { spacing })).toBe(40);
  });

  it('sums lines heightPt for a flowable fragment, ignoring any stale heightPt field', () => {
    const fragments = [{
      id: 'p1', blocks: [], heightPt: 999, atomic: false, spacingClass: 'body', lines: lines(3, 12),
    }];
    expect(contentHeightPt(fragments, { spacing })).toBe(36);
  });
});
