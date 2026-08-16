/**
 * Placement unit tests for `layout.mjs`.
 *
 * Everything here is a hand-built fragment fixture — no measurement, no PDF
 * context — so a page split is arithmetic anyone can check by hand:
 * PAGE_HEIGHT_PT 750 minus 2 x MARGIN_PT 25 leaves 700pt of usable content,
 * and each `question`->`question` pair costs a 14pt gap.
 */
import { describe, it, expect } from 'vitest';
import { placeFragments, contentHeightPt } from './layout.mjs';

const SPACING = { question: { question: 14 } };
const GEOMETRY = { pageHeightPt: 750, marginPt: 25, spacing: SPACING };
const CONTENT_TOP_PT = 25;
const CONTENT_BOTTOM_PT = 725;

/** N identical fixed-height question fragments — pure bin-packing fixture. */
const questions = (count, heightPt = 60) => Array.from({ length: count }, (_, i) => ({
  id: `q${i + 1}`, heightPt, atomic: true, spacingClass: 'question',
}));

const pageSizes = (result) => result.pages.map((page) => page.fragments.length);

describe('placeFragments — balance', () => {
  it('without balance: greedily overpacks page 1 and strands the remainder (baseline reproduction of the reported bug)', () => {
    // 60pt fragments + 14pt gaps: 74n - 14 <= 700 packs 9 onto page 1, so the
    // 10th falls alone onto page 2 — the greedy first-fit imbalance the real
    // worksheet shows as 7-on-page-1 / 3-on-page-2 with its mixed heights.
    const result = placeFragments(questions(10), GEOMETRY);

    expect(result.errors).toEqual([]);
    expect(result.pages).toHaveLength(2);
    expect(pageSizes(result)).toEqual([9, 1]);
  });

  it('with balance: splits evenly across the SAME page count', () => {
    const result = placeFragments(questions(10), { ...GEOMETRY, balance: true });

    expect(result.errors).toEqual([]);
    expect(result.pages).toHaveLength(2);
    expect(pageSizes(result)).toEqual([5, 5]);
  });

  it('balances against the true total content height, not the page capacity', () => {
    // 726pt of content over 2 pages -> a 363pt soft target; page 1 stops at
    // 356pt (5 fragments) because reaching 430pt (6) would overshoot further.
    expect(contentHeightPt(questions(10), { spacing: SPACING })).toBe(726);
  });

  it('never loses, reorders, or duplicates a fragment', () => {
    const unbalanced = placeFragments(questions(10), GEOMETRY);
    const balanced = placeFragments(questions(10), { ...GEOMETRY, balance: true });
    const ids = (result) => result.pages.flatMap((page) => page.fragments.map((f) => f.id));

    expect(ids(balanced)).toEqual(ids(unbalanced));
    expect(ids(balanced)).toEqual(questions(10).map((f) => f.id));
  });

  it('balance NEVER increases the page count — it falls back to the greedy placement verbatim', () => {
    // Greedy splits the 12-line flowable across pages 1-2 (2 pages). The soft
    // target instead breaks BEFORE it, which strands the whole 720pt fragment
    // on a page that only holds 700pt, forcing a 10/2 line split and a THIRD
    // page. Verified against a guard-disabled build: the rebalanced pass here
    // really does produce 3 pages, so this exercises the fallback rather than
    // a happy coincidence.
    const fragments = [
      { id: 'a', heightPt: 300, atomic: true, spacingClass: 'question' },
      { id: 'b', spacingClass: 'question', lines: Array.from({ length: 12 }, () => ({ heightPt: 60 })) },
    ];
    const unbalanced = placeFragments(fragments, GEOMETRY);
    const balanced = placeFragments(fragments, { ...GEOMETRY, balance: true });

    expect(unbalanced.pages).toHaveLength(2);
    expect(balanced.pages).toHaveLength(2);
    expect(balanced.pages).toEqual(unbalanced.pages);
    expect(balanced.errors).toEqual([]);
  });

  it('balance is a no-op for a single-page document', () => {
    const unbalanced = placeFragments(questions(3), GEOMETRY);
    const balanced = placeFragments(questions(3), { ...GEOMETRY, balance: true });

    expect(balanced.pages).toHaveLength(1);
    expect(balanced.pages).toEqual(unbalanced.pages);
  });

  it('the soft target never rejects a fragment the hard page ceiling would have accepted', () => {
    // `huge` is 690pt — nearly twice the 250pt soft target. It must still be
    // PLACED (on its own page), never dropped and never reported as
    // `fragment-exceeds-page`: the soft target only starts a page early, the
    // real ceiling still decides what fits.
    const fragments = [
      { id: 's1', heightPt: 30, atomic: true, spacingClass: 'question' },
      { id: 'huge', heightPt: 690, atomic: true, spacingClass: 'question' },
      { id: 's2', heightPt: 30, atomic: true, spacingClass: 'question' },
    ];
    const balanced = placeFragments(fragments, { ...GEOMETRY, balance: true });

    expect(balanced.errors).toEqual([]);
    expect(balanced.pages.flatMap((page) => page.fragments.map((f) => f.id)))
      .toEqual(['s1', 'huge', 's2']);
    expect(placeFragments(fragments, GEOMETRY).pages).toEqual(balanced.pages);
  });

  it('an explicit page_break still ends its page under balance', () => {
    const fragments = [
      { id: 'x1', heightPt: 60, atomic: true, spacingClass: 'question' },
      { id: 'brk', forceBreak: true, heightPt: 0, spacingClass: null },
      { id: 'x2', heightPt: 60, atomic: true, spacingClass: 'question' },
      { id: 'x3', heightPt: 60, atomic: true, spacingClass: 'question' },
    ];
    const balanced = placeFragments(fragments, { ...GEOMETRY, balance: true });

    expect(balanced.pages.map((page) => page.fragments.map((f) => f.id)))
      .toEqual([['x1'], ['x2', 'x3']]);
  });
});

describe('placeFragments — maxFillAfterPt caps fillAfter growth', () => {
  const flexQuestion = (id) => ({
    id, heightPt: 40, atomic: true, spacingClass: 'question', fillAfter: true,
  });
  const flexPage = () => [flexQuestion('a'), flexQuestion('b'), flexQuestion('c')];

  it('uncapped (the Infinity default): the whole spare is poured into the questions, exactly as before this change', () => {
    const { pages } = placeFragments(flexPage(), { ...GEOMETRY, growLastPage: true });
    const [a, b, c] = pages[0].fragments;

    // 700pt usable - (3 x 40pt + 2 x 14pt gaps) = 552pt spare over 3 shares =
    // 184pt each: every question balloons to 4.6x its own height, and the
    // first one starts a half-share (92pt) down the page. That is the bug.
    expect(a.heightPt - 40).toBeCloseTo(184, 1);
    expect(b.heightPt - 40).toBeCloseTo(184, 1);
    expect(a.yPt - CONTENT_TOP_PT).toBeCloseTo(92, 1);
    expect(b.yPt - a.yPt).toBeGreaterThan(200);
    expect(c.yPt + c.heightPt).toBeCloseTo(CONTENT_BOTTOM_PT - 92, 1);
  });

  it('capped: no fillAfter share exceeds the cap, and the remainder is left blank at the page bottom', () => {
    const { pages } = placeFragments(flexPage(), { ...GEOMETRY, growLastPage: true, maxFillAfterPt: 30 });
    const [a, b, c] = pages[0].fragments;

    expect(a.heightPt - 40).toBeCloseTo(30, 6);
    expect(b.heightPt - 40).toBeCloseTo(30, 6);
    expect(c.heightPt).toBeCloseTo(40, 6); // the last one never grows
    expect(a.yPt - CONTENT_TOP_PT).toBeCloseTo(15, 6); // half a capped share
    // Every interior pitch is now the fragment plus at most one capped share
    // plus the ordinary spacing gap.
    expect(b.yPt - a.yPt).toBeLessThanOrEqual(40 + 30 + 14 + 1e-6);
    expect(c.yPt - b.yPt).toBeLessThanOrEqual(40 + 30 + 14 + 1e-6);
    // Real leftover space now sits blank at the bottom instead of stretching.
    expect(CONTENT_BOTTOM_PT - (c.yPt + c.heightPt)).toBeGreaterThan(400);
  });

  it('the cap does not disturb real answerSpace growth, only the leftover fill', () => {
    const fragments = [
      { id: 'q1', heightPt: 40, spacingClass: 'question', answerSpace: { minPt: 40, maxPt: 200 }, fillAfter: true },
      { id: 'q2', heightPt: 40, spacingClass: 'question', answerSpace: { minPt: 40, maxPt: 200 }, fillAfter: true },
    ];
    const { pages } = placeFragments(fragments, { ...GEOMETRY, growLastPage: true, maxFillAfterPt: 30 });
    const [q1, q2] = pages[0].fragments;

    // 700 - 94 = 606pt spare, shared evenly until each hits its own 200pt cap.
    expect(q1.heightPt).toBeCloseTo(200 + 30, 6); // answerSpace cap, then one capped fill share
    expect(q2.heightPt).toBeCloseTo(200, 6); // last fillAfter fragment takes no share
  });

  it('omitting maxFillAfterPt is identical to passing Infinity (default keeps every existing render byte-for-byte)', () => {
    const omitted = placeFragments(flexPage(), { ...GEOMETRY, growLastPage: true });
    const explicit = placeFragments(flexPage(), { ...GEOMETRY, growLastPage: true, maxFillAfterPt: Infinity });

    expect(omitted).toEqual(explicit);
  });
});

describe('placeFragments — balanceReservePt (per-page furniture in the balance target)', () => {
  // A masthead that prints on page 1 only, then ten identical questions —
  // the shape of a real card-attached worksheet, where page 1 spends 200pt on
  // a banner page 2 never carries.
  const MASTHEAD_PT = 200;
  const SPACING_WITH_MASTHEAD = { question: { question: 14 }, heading: { question: 14 } };
  const MASTHEAD_GEOMETRY = { pageHeightPt: 750, marginPt: 25, spacing: SPACING_WITH_MASTHEAD };
  const withMasthead = () => [
    { id: 'masthead', heightPt: MASTHEAD_PT, atomic: true, spacingClass: 'heading' },
    ...questions(10),
  ];
  const questionsPerPage = (result) => result.pages
    .map((page) => page.fragments.filter((fragment) => fragment.id !== 'masthead').length);

  it('total content is 940pt over 2 pages — the arithmetic both cases below are read against', () => {
    // 200pt masthead + 14pt gap + 10 x 60pt + 9 x 14pt gaps.
    expect(contentHeightPt(withMasthead(), { spacing: SPACING_WITH_MASTHEAD })).toBe(940);
    expect(placeFragments(withMasthead(), MASTHEAD_GEOMETRY).pages).toHaveLength(2);
  });

  it('UNADJUSTED (no reserve): an even split of TOTAL height charges the masthead to page 1 and leaves it two questions short', () => {
    // Soft target 940/2 = 470pt on BOTH pages. Page 1 spends 200 of its 470
    // on the masthead, so it stops after 4 questions (496pt); page 2 spends
    // none, so it takes the other 6. Balanced by height, lopsided by eye.
    const result = placeFragments(withMasthead(), { ...MASTHEAD_GEOMETRY, balance: true });

    expect(result.errors).toEqual([]);
    expect(result.pages).toHaveLength(2);
    expect(questionsPerPage(result)).toEqual([4, 6]);
  });

  it('ADJUSTED: reserving the masthead on page 1 moves the split toward even — 5/5', () => {
    // Reserve 200 -> 740pt of shared content, 370pt each; page 1's target is
    // 370 + 200 = 570pt, page 2's is 370pt. Page 1 now takes 5 questions.
    const result = placeFragments(withMasthead(), {
      ...MASTHEAD_GEOMETRY, balance: true, balanceReservePt: [MASTHEAD_PT],
    });

    expect(result.errors).toEqual([]);
    expect(result.pages).toHaveLength(2);
    expect(questionsPerPage(result)).toEqual([5, 5]);
    // Still one masthead, still ten questions, still in order.
    expect(result.pages.flatMap((page) => page.fragments.map((f) => f.id)))
      .toEqual(withMasthead().map((f) => f.id));
  });

  it('the reserve is inert without balance — a non-fill render is byte-identical with or without it', () => {
    const without = placeFragments(withMasthead(), MASTHEAD_GEOMETRY);
    const withReserve = placeFragments(withMasthead(), { ...MASTHEAD_GEOMETRY, balanceReservePt: [MASTHEAD_PT] });

    expect(withReserve).toEqual(without);
  });

  it('an empty reserve array is the plain contentHeight/pageCount target, byte-for-byte', () => {
    const omitted = placeFragments(withMasthead(), { ...MASTHEAD_GEOMETRY, balance: true });
    const explicit = placeFragments(withMasthead(), { ...MASTHEAD_GEOMETRY, balance: true, balanceReservePt: [] });

    expect(explicit).toEqual(omitted);
  });

  it('a reserve larger than the whole document cannot produce a negative share, lose a fragment, or add a page', () => {
    const absurd = placeFragments(withMasthead(), {
      ...MASTHEAD_GEOMETRY, balance: true, balanceReservePt: [10000],
    });

    expect(absurd.errors).toEqual([]);
    expect(absurd.pages).toHaveLength(2);
    expect(absurd.pages.flatMap((page) => page.fragments.map((f) => f.id)))
      .toEqual(withMasthead().map((f) => f.id));
  });

  it('the hard page ceiling still governs: a reserve cannot push more onto a page than fits', () => {
    // Reserve 600 -> 340pt shared, 170 each, so page 1's soft target is
    // 770pt — more than the 700pt page physically holds. The ceiling, not the
    // target, has to be what stops page 1.
    const result = placeFragments(withMasthead(), {
      ...MASTHEAD_GEOMETRY, balance: true, balanceReservePt: [600],
    });
    const page1Pt = result.pages[0].fragments
      .reduce((total, fragment) => Math.max(total, fragment.yPt + fragment.heightPt), 0);

    expect(result.errors).toEqual([]);
    expect(page1Pt).toBeLessThanOrEqual(CONTENT_BOTTOM_PT + 1e-6);
  });
});
