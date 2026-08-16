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
