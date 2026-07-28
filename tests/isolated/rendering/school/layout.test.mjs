import { describe, it, expect } from 'vitest';
import { placeFragments } from '../../../../backend/src/1_rendering/school/documents/layout.mjs';

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
